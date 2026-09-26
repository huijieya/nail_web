from pathlib import Path
import hashlib
import json
import struct
import time

import numpy as np
from PIL import Image, ImageDraw


ROOT = Path(__file__).resolve().parents[1]
OUTPUT = ROOT / 'public' / 'nail-masks'
REPORT = ROOT / 'docs'
FINGERS = ['小拇指', '无名指', '中指', '食指', '大拇指']
SHAPES = ['杏仁形', '方圆形', '方形', '椭圆形', '梯形', '尖形']
LENGTHS = ['儿童款', '短', '中', '中长', '长', '超长']
DTYPE = np.dtype([('normal', '<f4', 3), ('vertices', '<f4', (3, 3)), ('attribute', '<u2')])


def project(vertices, width, height):
    surface = Image.new('L', (width, height))
    drawing = ImageDraw.Draw(surface)
    coordinates = vertices * [width - 1, height - 1]
    for triangle in coordinates:
        drawing.polygon(tuple(triangle.reshape(-1)), fill=255)
    return surface


def compare_group(entries, silhouettes):
    masks = [silhouettes[entry['id']] for entry in entries]
    scores = np.ones((len(masks), len(masks)))
    for first in range(len(masks)):
        for second in range(first):
            scores[first, second] = scores[second, first] = np.count_nonzero(masks[first] & masks[second]) / np.count_nonzero(masks[first] | masks[second])
    medoid = int(np.argmax(scores.mean(axis=1)))
    worst = int(np.argmin(scores[medoid]))
    reference = masks[medoid]
    target = masks[worst]
    valid = reference.any(axis=1) & target.any(axis=1)
    left_error = np.abs(reference.argmax(axis=1) - target.argmax(axis=1))[valid]
    right_error = np.abs(reference[:, ::-1].argmax(axis=1) - target[:, ::-1].argmax(axis=1))[valid]
    errors = np.concatenate([left_error, right_error]) / reference.shape[1] * 100
    return {
        'count': len(entries), 'template': entries[medoid]['id'],
        'meanIoU': round(float(scores[medoid].mean()), 6),
        'minIoU': round(float(scores[medoid, worst]), 6),
        'worst': entries[worst]['id'],
        'worstRowEdgeP95PercentWidth': round(float(np.percentile(errors, 95)), 3),
        'worstRowEdgeMaxPercentWidth': round(float(errors.max()), 3),
    }


def main():
    started = time.perf_counter()
    OUTPUT.mkdir(parents=True, exist_ok=True)
    REPORT.mkdir(exist_ok=True)
    entries = []
    silhouettes = {}
    files = sorted((ROOT / 'public' / '甲型').rglob('*.stl'))
    for index, source in enumerate(files):
        data = source.read_bytes()
        triangle_count = struct.unpack_from('<I', data, 80)[0]
        assert len(data) == 84 + 50 * triangle_count, source
        vertices = np.frombuffer(data, dtype=DTYPE, offset=84, count=triangle_count)['vertices'].astype(np.float64)
        minimum = vertices.min(axis=(0, 1))
        maximum = vertices.max(axis=(0, 1))
        width, height = maximum[0] - minimum[0], maximum[2] - minimum[2]
        normalized = np.stack([(maximum[0] - vertices[:, :, 0]) / width, (vertices[:, :, 2] - minimum[2]) / height], axis=2)
        shape = '尖形' if source.parent.parent.name == '尖形-水滴形' else source.parent.parent.name
        length = source.parent.name
        finger = next(finger for finger in FINGERS if source.stem.endswith(finger))
        identity = f'{shape}/{length}/{FINGERS.index(finger)}'
        digest = hashlib.sha256(data).hexdigest()
        pixel_height = round(512 * height / width)
        alpha = project(normalized, 1024, pixel_height * 2).resize((512, pixel_height), Image.Resampling.LANCZOS)
        silhouettes[identity] = np.asarray(alpha.resize((512, 512), Image.Resampling.LANCZOS)) >= 128
        entries.append({'id': identity, 'shape': shape, 'length': length, 'finger': FINGERS.index(finger), 'width': float(width), 'height': float(height), 'source': '/' + source.relative_to(ROOT / 'public').as_posix(), 'sha256': digest, 'triangles': triangle_count})
        print(f'{index + 1}/{len(files)} {identity}', flush=True)
    assert len(entries) == 150
    families = {}
    sheet = Image.new('RGB', (6 * 256, 280), '#252525')
    labels = ['Almond', 'Squoval', 'Square', 'Oval', 'Coffin', 'Stiletto']
    for column, shape in enumerate(SHAPES):
        members = [entry for entry in entries if entry['shape'] == shape]
        family = compare_group(members, silhouettes)
        family['lengths'] = {length: compare_group([entry for entry in members if entry['length'] == length], silhouettes) for length in LENGTHS if any(entry['length'] == length for entry in members)}
        family['widthRange'] = [min(entry['width'] for entry in members), max(entry['width'] for entry in members)]
        family['heightRange'] = [min(entry['height'] for entry in members), max(entry['height'] for entry in members)]
        family['dimensions'] = {length: [[round(entry['width'], 6), round(entry['height'], 6)] for entry in sorted(members, key=lambda entry: entry['finger']) if entry['length'] == length] for length in LENGTHS if any(entry['length'] == length for entry in members)}
        families[shape] = family
        template = next(entry for entry in members if entry['id'] == family['template'])
        source = ROOT / 'public' / template['source'].lstrip('/')
        vertices = np.frombuffer(source.read_bytes(), dtype=DTYPE, offset=84)['vertices'].astype(np.float64)
        minimum, maximum = vertices.min(axis=(0, 1)), vertices.max(axis=(0, 1))
        normalized = np.stack([(maximum[0] - vertices[:, :, 0]) / template['width'], (vertices[:, :, 2] - minimum[2]) / template['height']], axis=2)
        alpha = project(normalized, 4096, 4096).resize((2048, 2048), Image.Resampling.LANCZOS)
        mask = Image.new('RGBA', alpha.size, 'white')
        mask.putalpha(alpha)
        filename = f"family-{template['sha256'][:16]}.png"
        mask.save(OUTPUT / filename, optimize=True)
        shared = np.asarray(alpha.resize((512, 512), Image.Resampling.LANCZOS)) >= 128
        shared_scores = [np.count_nonzero(shared & silhouettes[entry['id']]) / np.count_nonzero(shared | silhouettes[entry['id']]) for entry in members]
        family['sharedMaskMinIoU'] = round(float(min(shared_scores)), 6)
        assert min(shared_scores) >= .995, f'{shape}: shared mask exceeds 0.5% mismatch budget'
        for entry in members:
            entry['mask'] = f'/nail-masks/{filename}'
        reference, worst = silhouettes[family['template']], silhouettes[family['worst']]
        overlay = np.full((512, 512, 3), 37, dtype=np.uint8)
        overlay[reference & worst] = [200, 200, 200]
        overlay[reference & ~worst] = [220, 150, 70]
        overlay[worst & ~reference] = [150, 125, 230]
        sheet.paste(Image.fromarray(overlay).resize((240, 240)), (column * 256 + 8, 32))
        ImageDraw.Draw(sheet).text((column * 256 + 10, 8), labels[column], fill='white')
    sheet.save(REPORT / 'mask-comparison.png')
    (ROOT / 'src' / 'nail-masks.json').write_text(json.dumps(entries, ensure_ascii=False, separators=(',', ':')) + '\n')
    used_masks = {entry['mask'] for entry in entries}
    for generated in OUTPUT.glob('*.png'):
        if '/nail-masks/' + generated.name not in used_masks:
            generated.unlink()
    result = {'method': 'Full triangle union, X mirrored, Z root-to-tip. Independent width/height normalization; 512x512 binary comparison. Medoid maximizes mean IoU. Row edge errors are horizontal differences, not Hausdorff distance. Shared masks: 4096px triangle union downsampled to 2048px.', 'sourceBytes': sum(source.stat().st_size for source in files), 'maskBytes': sum((ROOT / 'public' / mask.lstrip('/')).stat().st_size for mask in used_masks), 'families': families}
    (REPORT / 'mask-analysis.json').write_text(json.dumps(result, ensure_ascii=False, indent=2) + '\n')
    print(json.dumps(result, ensure_ascii=False, indent=2), flush=True)
    print(f'Completed in {time.perf_counter() - started:.1f}s', flush=True)


if __name__ == '__main__':
    main()

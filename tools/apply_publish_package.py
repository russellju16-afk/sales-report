#!/usr/bin/env python3
import argparse
import base64
import hashlib
import json
import os
import sys


def sha256_hex(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def load_package(path: str) -> dict:
    with open(path, 'r', encoding='utf-8') as f:
        return json.load(f)


def is_safe_relative_path(rel_path: str) -> bool:
    if os.path.isabs(rel_path):
        return False
    norm = os.path.normpath(rel_path)
    if norm.startswith('..' + os.sep) or norm == '..':
        return False
    return True


def apply_package(pkg: dict, repo_root: str) -> list:
    kind = pkg.get('kind')
    if kind != 'PUBLISH_PACKAGE':
        raise ValueError(f"kind must be 'PUBLISH_PACKAGE', got: {kind!r}")

    files = pkg.get('files')
    if not isinstance(files, list):
        raise ValueError('files must be a list')

    results = []
    for idx, item in enumerate(files, start=1):
        if not isinstance(item, dict):
            raise ValueError(f'files[{idx}] must be an object')
        rel_path = item.get('path')
        encoding = item.get('encoding', 'base64')
        content_b64 = item.get('content_base64')

        if not rel_path or not isinstance(rel_path, str):
            raise ValueError(f'files[{idx}] missing valid path')
        if encoding != 'base64':
            raise ValueError(f"files[{idx}] encoding must be 'base64', got: {encoding!r}")
        if not isinstance(content_b64, str):
            raise ValueError(f'files[{idx}] missing valid content_base64')
        if not is_safe_relative_path(rel_path):
            raise ValueError(f'files[{idx}] path must be repo-relative: {rel_path!r}')

        dest_path = os.path.join(repo_root, rel_path)
        dest_dir = os.path.dirname(dest_path)
        if dest_dir:
            os.makedirs(dest_dir, exist_ok=True)

        try:
            raw = base64.b64decode(content_b64, validate=True)
        except Exception as exc:
            raise ValueError(f'files[{idx}] content_base64 decode failed: {rel_path!r}') from exc

        try:
            text = raw.decode('utf-8')
        except UnicodeDecodeError as exc:
            raise ValueError(f'files[{idx}] content is not valid UTF-8: {rel_path!r}') from exc

        with open(dest_path, 'w', encoding='utf-8', newline='') as f:
            f.write(text)

        results.append({
            'path': rel_path,
            'bytes': len(raw),
            'sha256': sha256_hex(raw),
        })

    return results


def main(argv: list) -> int:
    parser = argparse.ArgumentParser(description='Apply a publish package to the repo.')
    parser.add_argument(
        'package_path',
        nargs='?',
        default='PUBLISH_PACKAGE_hotfix_20251225.json',
        help='Path to publish package JSON (default: ./PUBLISH_PACKAGE_hotfix_20251225.json)'
    )
    args = parser.parse_args(argv)

    repo_root = os.getcwd()
    pkg = load_package(args.package_path)
    results = apply_package(pkg, repo_root)

    for item in results:
        print(f"{item['path']}\t{item['bytes']}\t{item['sha256']}")

    return 0


if __name__ == '__main__':
    sys.exit(main(sys.argv[1:]))

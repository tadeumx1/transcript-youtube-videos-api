"""Inspect every saved image layer, including files later hidden by another layer."""
import sys
import tarfile
from pathlib import PurePosixPath

layers = 0
application_files = 0
with tarfile.open(sys.argv[1]) as image:
    for member in image:
        if not member.isfile():
            continue
        stream = image.extractfile(member)
        # OCI exports identify layers by their tar payload rather than layer.tar names.
        try:
            layer = tarfile.open(fileobj=stream, mode='r|*')
            layers += 1
            for entry in layer:
                path = PurePosixPath(entry.name)
                if not entry.isfile():
                    continue
                if (str(path).startswith('app/') or str(path).startswith('usr/share/nginx/html/')) and 'node_modules' not in path.parts:
                    application_files += 1
                    assert not path.name.startswith('.env'), str(path)
                    assert path.name != 'local.sqlite', str(path)
                    if entry.size < 10000000:
                        body = layer.extractfile(entry).read()
                        assert sys.argv[2].encode() not in body, str(path)
                        assert b'local-data-sentinel' not in body, str(path)
        except tarfile.ReadError:
            pass
assert layers > 0, 'No image layers inspected'
assert application_files > 0, 'No application files inspected'
print(f'{layers} image layers and {application_files} application files inspected: no fixture secrets or local data')

"""Container lifecycle contracts exercised against a recording Docker CLI."""
import json
import os
from pathlib import Path
import shutil
import socket
import subprocess
import sys
import tempfile
import time
import unittest

ROOT = Path(__file__).resolve().parents[2]


class LauncherTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.root = Path(self.temp.name)
        (self.root / 'scripts').mkdir()
        (self.root / 'services/channel-library').mkdir(parents=True)
        shutil.copy(ROOT / 'scripts/docker.py', self.root / 'scripts/docker.py')
        (self.root / 'compose.yaml').write_text('services: {}\n')
        for path in ['.env', 'services/channel-library/.env']:
            (self.root / path).write_text('SECRET=must-not-be-printed\n')
        self.bin = self.root / 'bin'
        self.bin.mkdir()
        self.record = self.root / 'commands.jsonl'
        (self.bin / 'docker').write_text('''#!/usr/bin/python3
import json,os,sys,time
args=sys.argv[1:]
with open(os.environ['RECORD'],'a') as f:f.write(json.dumps(args)+'\\n')
fail=os.environ.get('FAIL','')
if args==['compose','version'] and fail=='compose':sys.exit(1)
if args==['info'] and fail=='engine':sys.exit(1)
if 'config' in args and fail=='config':sys.exit(1)
if 'ps' in args and '-q' in args:
 print('existing' if fail=='existing' else ('created' if os.path.exists(os.environ['RECORD']+'.started') else ''))
elif 'up' in args:
 open(os.environ['RECORD']+'.started','w').close()
 if fail=='up':sys.exit(1)
elif 'port' in args:print('127.0.0.1:49153')
elif 'logs' in args and '--follow' in args:
 print('library | listening',flush=True)
 while True:time.sleep(1)
elif args[:2]==['network','ls']:pass
''')
        (self.bin / 'docker').chmod(0o755)
        self.env = {**os.environ, 'PATH': str(self.bin), 'RECORD': str(self.record),
                    'DOCKER_PROJECT_NAME': 'test-' + self.root.name}
        self.env.pop('DOCKER_WEB_PORT', None)

    def tearDown(self):
        self.temp.cleanup()

    def run_cli(self, command='up', **values):
        return subprocess.run([sys.executable, str(self.root / 'scripts/docker.py'), command],
                              env={**self.env, **values}, text=True, capture_output=True, timeout=10)

    def commands(self):
        return [json.loads(x) for x in self.record.read_text().splitlines()] if self.record.exists() else []

    def test_prerequisites(self):
        for failure, name in [('docker','Docker'), ('compose','Compose'), ('engine','engine'),
                              ('root-env','.env'), ('library-env','services/channel-library/.env')]:
            with self.subTest(failure=failure):
                values={'FAIL': failure}
                path=None
                if failure=='docker':values['PATH']=str(self.root / 'missing')
                if failure.endswith('-env'):
                    path=self.root / ('.env' if failure=='root-env' else 'services/channel-library/.env')
                    path.rename(str(path)+'.save')
                try:
                    result=self.run_cli(**values)
                    self.assertNotEqual(result.returncode,0)
                    self.assertIn(name,result.stdout+result.stderr)
                    self.assertNotIn('must-not-be-printed',result.stdout+result.stderr)
                    self.assertFalse(any('up' in c for c in self.commands()))
                finally:
                    if path:Path(str(path)+'.save').rename(path)

    def test_port_rejection(self):
        with socket.socket() as occupied:
            occupied.bind(('127.0.0.1',0));occupied.listen()
            for port in ['0','-1','65536','abc',str(occupied.getsockname()[1])]:
                result=self.run_cli(DOCKER_WEB_PORT=port)
                self.assertNotEqual(result.returncode,0)
                self.assertIn('DOCKER_WEB_PORT',result.stdout+result.stderr)
            self.assertEqual((self.root / '.env').read_text(),'SECRET=must-not-be-printed\n')
            self.assertEqual((self.root / 'services/channel-library/.env').read_text(),'SECRET=must-not-be-printed\n')
            self.assertFalse(any('up' in c for c in self.commands()))

    def test_cleanup(self):
        result=self.run_cli(FAIL='existing')
        self.assertNotEqual(result.returncode,0)
        self.assertFalse(any(c[:2]==['rm','-f'] or 'down' in c for c in self.commands()))
        result=self.run_cli(FAIL='up')
        self.assertNotEqual(result.returncode,0)
        self.assertIn(['rm','-f','created'],self.commands())
        self.assertFalse(any('-v' in c or '--volumes' in c for c in self.commands()))

    def test_commands(self):
        for command, expected in [('status','ps'),('logs','logs'),('down','down')]:
            result=self.run_cli(command)
            self.assertEqual(result.returncode,0,result.stderr)
            self.assertTrue(any(expected in c for c in self.commands()))
        self.assertFalse(any('up' in c or '--volumes' in c for c in self.commands()))
        # Shutdown/status still work if an operator has moved their env files.
        (self.root/'.env').unlink();(self.root/'services/channel-library/.env').unlink()
        self.assertEqual(self.run_cli('down').returncode,0)

    def test_documentation(self):
        text=(ROOT/'docs/docker.md').read_text()
        for value in ['docker version','docker compose version','WSL','services/channel-library/.env',
                      'make docker-up','make docker-down','make docker-status','make docker-logs',
                      'backup','restore','deletes','volumes','newgrp docker']:
            self.assertIn(value,text)

    def test_runtime_gate(self):
        result=subprocess.run([shutil.which('node'),'--test',str(ROOT/'test/docker/stack.test.mjs')],
                              env={**os.environ,'PATH':str(self.root/'missing')},capture_output=True,text=True,timeout=30)
        self.assertNotEqual(result.returncode,0)
        self.assertIn('Docker runtime proof unavailable',result.stdout+result.stderr)

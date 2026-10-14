#!/usr/bin/env python3
"""Operate one local Compose project without host Node/npm dependencies."""
import fcntl
import hashlib
import os
from pathlib import Path
import re
import shutil
import signal
import socket
import subprocess
import sys
import tempfile
import uuid

ROOT = Path(__file__).resolve().parent.parent
PROJECT = os.environ.get('DOCKER_PROJECT_NAME', 'transcript-library')
ENV = dict(os.environ, COMPOSE_PROJECT_NAME=PROJECT, DOCKER_RUN_ID=uuid.uuid4().hex,
           DOCKER_WEB_PORT=os.environ.get('DOCKER_WEB_PORT', '0'))
PRIMARY = Path(os.environ.get('TRANSCRIPT_ENV_FILE', ROOT / '.env')).resolve()
LIBRARY = Path(os.environ.get('LIBRARY_ENV_FILE', ROOT / 'services/channel-library/.env')).resolve()
ENV.update(TRANSCRIPT_ENV_FILE=str(PRIMARY), LIBRARY_ENV_FILE=str(LIBRARY))
COMPOSE = ['docker', 'compose', '--project-name', PROJECT, '--env-file', str(PRIMARY if PRIMARY.is_file() else '/dev/null'), '-f', str(ROOT / 'compose.yaml')]
child = None
interrupted = False


def run(args, capture=False):
    global child
    child = subprocess.Popen(args, cwd=ROOT, env=ENV, text=True,
                             stdout=subprocess.PIPE if capture else None,
                             stderr=subprocess.PIPE if capture else None,
                             start_new_session=True)
    out, _ = child.communicate()
    status = child.returncode
    child = None
    if status:
        raise RuntimeError('Command failed: ' + ' '.join(args[:2]))
    return (out or '').strip()


def stop(signum, _frame):
    global interrupted
    interrupted = True
    if child and child.poll() is None:
        os.killpg(child.pid, signal.SIGTERM)


def log(message):
    print('[docker] ' + message, flush=True)


def preflight(starting):
    if not re.fullmatch(r'[a-z0-9][a-z0-9_-]*', PROJECT):
        raise RuntimeError('DOCKER_PROJECT_NAME must contain lowercase letters, digits, underscores or hyphens.')
    if not shutil.which('docker'):
        raise RuntimeError('Docker CLI is missing. Enable Docker integration for this WSL distribution.')
    try:
        run(['docker', 'compose', 'version'], True)
    except RuntimeError:
        raise RuntimeError('Docker Compose is unavailable. Install Compose v2.24 or newer.') from None
    try:
        run(['docker', 'info'], True)
    except RuntimeError:
        raise RuntimeError('Docker engine is unavailable to this shell. Check docker version, WSL integration and group membership (newgrp docker).') from None
    if starting:
        for path, label in [(PRIMARY, '.env'), (LIBRARY, 'services/channel-library/.env')]:
            if not path.is_file():
                raise RuntimeError('Missing required environment file: ' + label)
        value = os.environ.get('DOCKER_WEB_PORT')
        if value is not None:
            if not value.isascii() or not value.isdecimal() or not 1 <= int(value) <= 65535:
                raise RuntimeError('DOCKER_WEB_PORT must be an integer between 1 and 65535.')
            try:
                with socket.socket() as port:
                    port.bind(('127.0.0.1', int(value)))
            except OSError:
                raise RuntimeError('DOCKER_WEB_PORT is unavailable; choose a free port or unset it.') from None
        try:
            run(COMPOSE + ['config', '--quiet'], True)
        except RuntimeError:
            raise RuntimeError('Compose configuration is invalid. Check the two environment files; values have not been printed.') from None


def cleanup():
    # The invocation label also excludes containers created concurrently by another client.
    ids = run(['docker', 'ps', '-a', '-q', '--filter',
               'label=com.docker.compose.project=' + PROJECT, '--filter',
               'label=io.transcript-library.run=' + ENV['DOCKER_RUN_ID']], True).split()
    if ids:
        try:
            run(['docker', 'stop', '--time', '20', *ids], True)
        finally:
            run(['docker', 'rm', '-f', *ids], True)
    networks = run(['docker', 'network', 'ls', '--filter', 'label=com.docker.compose.project=' + PROJECT, '-q'], True).split()
    for network in networks:
        try:
            run(['docker', 'network', 'rm', network], True)
        except RuntimeError:
            pass  # Docker refuses removal while an unrelated container still uses the network.
    log('Containers stopped. Persistent volumes retained.')


def main():
    command = sys.argv[1] if len(sys.argv) == 2 else ''
    if command not in ['up', 'down', 'status', 'logs']:
        raise RuntimeError('Usage: python3 scripts/docker.py up|down|status|logs')
    preflight(command == 'up')
    if command != 'up':
        run(COMPOSE + {'down': ['down'], 'status': ['ps', '-a'], 'logs': ['logs', '--tail', '200']}[command])
        return
    digest = hashlib.sha256(PROJECT.encode()).hexdigest()[:20]
    with open(Path(tempfile.gettempdir()) / f'transcript-docker-{os.getuid()}-{digest}.lock', 'w') as lock:
        try:
            fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
        except BlockingIOError:
            raise RuntimeError('This Docker project already has an attached launcher.') from None
        if run(COMPOSE + ['ps', '-a', '-q'], True):
            raise RuntimeError('This Docker project already has containers. Use make docker-status or make docker-down first.')
        signal.signal(signal.SIGINT, stop)
        signal.signal(signal.SIGTERM, stop)
        log('Building three application images. The first build downloads dependencies and the encoder model.')
        run(COMPOSE + ['build'])
        if interrupted:
            return
        try:
            log('Starting services; waiting up to 180 seconds for health checks.')
            run(COMPOSE + ['up', '-d', '--no-build', '--wait', '--wait-timeout', '180'])
            address = run(COMPOSE + ['port', 'web', '8080'], True)
            if not re.fullmatch(r'127\.0\.0\.1:[0-9]+', address):
                raise RuntimeError('Docker did not publish a loopback browser address.')
            log('URL: http://' + address)
            log('Following transcript, library and web logs. Ctrl+C stops this session.')
            run(COMPOSE + ['logs', '--follow', '--tail', '100'])
        finally:
            cleanup()


if __name__ == '__main__':
    try:
        main()
    except (RuntimeError, OSError) as error:
        if not interrupted:
            print('[docker] ' + str(error), file=sys.stderr)
            sys.exit(1)

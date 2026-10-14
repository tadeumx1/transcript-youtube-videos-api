.PHONY: dev

dev:
	@exec node scripts/dev.mjs

.PHONY: docker-up docker-down docker-status docker-logs

docker-up:
	@exec python3 scripts/docker.py up

docker-down:
	@exec python3 scripts/docker.py down

docker-status:
	@exec python3 scripts/docker.py status

docker-logs:
	@exec python3 scripts/docker.py logs

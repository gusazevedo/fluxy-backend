# SAM "makefile" build for the API Lambda (BuildMethod: makefile).
#
# We bundle the app with esbuild, but two packages are kept external and
# installed into the artifact instead of being bundled:
#   - @node-rs/argon2     -> ships a native binary (can't be bundled)
#   - @fastify/swagger-ui -> serves static assets from its own directory
#
# The native binary is fetched for the Lambda platform (linux/arm64) via npm's
# --os/--cpu/--libc overrides, so a plain `sam build` (no container) works.

ARTIFACT_DEPS := {"type":"module","dependencies":{"@node-rs/argon2":"^2.0.2","@fastify/swagger-ui":"^5.2.6"}}

build-ApiFunction:
	npx esbuild src/lambda.ts \
		--bundle \
		--platform=node \
		--target=node22 \
		--format=esm \
		--external:@node-rs/argon2 \
		--external:@fastify/swagger-ui \
		--banner:js="import { createRequire } from 'module'; const require = createRequire(import.meta.url);" \
		--outfile="$(ARTIFACTS_DIR)/lambda.mjs"
	printf '%s' '$(ARTIFACT_DEPS)' > "$(ARTIFACTS_DIR)/package.json"
	cd "$(ARTIFACTS_DIR)" && npm install --os=linux --cpu=arm64 --libc=glibc --omit=dev --no-audit --no-fund --no-package-lock

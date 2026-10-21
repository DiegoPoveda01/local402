# The published kit, not this repository: the image installs local402-facilitator from npm, so the build
# context can be an empty folder.
#
#   docker build --build-arg VERSION=1.0.0 -t local402-facilitator .
#   docker run --env-file .env -p 4022:4022 local402-facilitator
#   docker run --env-file .env local402-facilitator local402-facilitator check
FROM node:22-slim
ARG VERSION=latest
RUN npm install -g local402-facilitator@${VERSION} && npm cache clean --force
ENV NODE_ENV=production PORT=4022
EXPOSE 4022
USER node
WORKDIR /home/node
# Liveness only. Point the host's readiness check (or load balancer) at /ready.
HEALTHCHECK --interval=30s --timeout=5s CMD node -e "fetch('http://127.0.0.1:'+process.env.PORT+'/health').then(r=>process.exit(r.ok?0:1),()=>process.exit(1))"
CMD ["local402-facilitator"]

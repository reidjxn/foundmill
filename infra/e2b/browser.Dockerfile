# The E2B template the hosted browser starts from (founder, Nov 22, 2026: E2B in place of Browserbase).
#
# Why a template of its own: E2B's public `desktop` template has a desktop and its screen stream, but no Node.js and no
# browser Playwright can drive, so the gateway's driver (apps/gateway/src/browser-e2b.ts) could not start in it. This
# image has what the driver and the `@e2b/desktop` SDK need and nothing the project's own sandbox has:
# - Xvfb and xdpyinfo (the SDK starts the display), Xfce (the SDK starts the desktop session), x11vnc and E2B's noVNC fork
#   in /opt/noVNC (the SDK starts the stream the founder watches and takes over in);
# - Node 22 and playwright-core 1.63.0 in /opt/fm-browser, with Playwright's own Chromium under /opt/pw-browsers, so a
#   session needs nothing from the npm registry before its egress is narrowed to the site.
# It is never the project's CLI-Anything sandbox (e2b.Dockerfile).
#
# Build (once per change): the GitHub Actions workflow "E2B sandbox template" with name `foundmill-browser` and dockerfile
# `browser.Dockerfile`, or from any machine with the key in its environment:
#   npx @e2b/cli@2.22.3 template create foundmill-browser --path infra/e2b --dockerfile browser.Dockerfile --cpu-count 2 --memory-mb 2048
# The gateway uses it by default (`E2B_BROWSER_TEMPLATE`, empty = foundmill-browser).
FROM node:22.23.3-bookworm

ENV DEBIAN_FRONTEND=noninteractive
ENV PLAYWRIGHT_BROWSERS_PATH=/opt/pw-browsers

RUN apt-get update && apt-get install -y --no-install-recommends \
      xvfb x11-utils xauth xfce4 xfce4-terminal dbus-x11 x11vnc xdotool git ca-certificates fonts-liberation fonts-noto-color-emoji procps \
 && git clone --depth 1 --branch e2b-desktop https://github.com/e2b-dev/noVNC.git /opt/noVNC \
 && ln -s /opt/noVNC/vnc.html /opt/noVNC/index.html \
 && git clone --depth 1 --branch v0.12.0 https://github.com/novnc/websockify /opt/noVNC/utils/websockify \
 && mkdir -p /opt/fm-browser && cd /opt/fm-browser && npm install --no-save --no-audit --no-fund playwright-core@1.63.0 \
 && npx --yes playwright@1.63.0 install --with-deps chromium \
 && rm -rf /var/lib/apt/lists/* /root/.npm

# E2B runs commands as `user`; the browser and the driver's library must be readable by it.
RUN chmod -R a+rX /opt/pw-browsers /opt/fm-browser /opt/noVNC

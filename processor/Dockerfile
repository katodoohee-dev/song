FROM node:22-bookworm-slim
RUN apt-get update && apt-get install -y --no-install-recommends python3 python3-venv ffmpeg && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY package*.json ./
RUN npm ci --omit=dev
RUN python3 -m venv /opt/audio
ENV PATH="/opt/audio/bin:$PATH"
COPY processor/requirements.txt processor/requirements.txt
RUN pip install --no-cache-dir torch==2.5.1 torchaudio==2.5.1 --index-url https://download.pytorch.org/whl/cpu && pip install --no-cache-dir -r processor/requirements.txt
COPY . .
ENV PROCESSING_ENABLED=true PROCESSING_DIR=/data/processing STORAGE_DIR=/data/storage PORT=10000
EXPOSE 10000
CMD ["node", "auth-server.mjs"]

FROM python:3.11-slim

WORKDIR /app

# System deps for chromadb's native extensions
RUN apt-get update && apt-get install -y \
    gcc \
    g++ \
    && rm -rf /var/lib/apt/lists/*

# Install Python deps
COPY pyproject.toml ./
COPY src/ ./src/
RUN pip install --no-cache-dir --upgrade pip && \
    pip install --no-cache-dir -e .

EXPOSE 3003

ENV PORT=3003
ENV PYTHONUNBUFFERED=1
ENV DATA_DIR=/data/docs
ENV DB_DIR=/data/chromadb

CMD ["python", "-m", "src.server"]

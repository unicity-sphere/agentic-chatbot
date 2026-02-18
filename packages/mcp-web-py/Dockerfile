FROM python:3.11-slim

WORKDIR /app

# Install system dependencies
RUN apt-get update && apt-get install -y \
    gcc \
    g++ \
    libcurl4-openssl-dev \
    && rm -rf /var/lib/apt/lists/*

# Copy dependency files
COPY pyproject.toml ./

# Install Python dependencies
RUN pip install --no-cache-dir --upgrade pip && \
    pip install --no-cache-dir -e .

# Copy source code
COPY src/ ./src/

# Expose port
EXPOSE 3002

# Set environment
ENV PORT=3002
ENV PYTHONUNBUFFERED=1
ENV SEARXNG_URL=http://localhost:8888
ENV SEARXNG_KEY=

# Run server
CMD ["python", "-m", "src.server"]

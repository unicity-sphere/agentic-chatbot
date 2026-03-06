FROM python:3.11-slim

WORKDIR /app

# Install system dependencies
RUN apt-get update && apt-get install -y \
    gcc \
    g++ \
    libcurl4-openssl-dev \
    && rm -rf /var/lib/apt/lists/*

# Copy dependency files and source
COPY pyproject.toml ./
COPY src/ ./src/

# Install Python dependencies
RUN pip install --no-cache-dir --upgrade pip && \
    pip install --no-cache-dir -e .

# Expose port
EXPOSE 3002

# Set environment
ENV PORT=3002
ENV PYTHONUNBUFFERED=1
ENV SEARXNG_URL=http://searxng:8080
ENV SEARXNG_KEY=

# Run server
CMD ["python", "-m", "src"]

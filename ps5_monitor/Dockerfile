ARG BUILD_FROM
FROM $BUILD_FROM

# Set environment
ENV LANG=C.UTF-8 \
    PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1

# Install runtime dependencies
RUN apk add --no-cache \
    python3 \
    py3-pip \
    bash \
    curl

WORKDIR /app

# Copy requirements and install
COPY requirements.txt /app/requirements.txt
RUN pip install --no-cache-dir --break-system-packages -r requirements.txt

# Copy application files and s6-overlay rootfs
COPY app/ /app/
COPY ps5-monitor-card.js /app/ps5-monitor-card.js
COPY rootfs/ /

# Ensure executable permissions on s6 service
RUN chmod +x /etc/s6-overlay/s6-rc.d/ps5-monitor/run

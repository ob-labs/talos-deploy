FROM ubuntu:22.04

RUN apt-get update && apt-get install -y \
    openssh-server curl git tmux ripgrep fd-find jq build-essential sudo \
    && rm -rf /var/lib/apt/lists/*

RUN useradd -m -s /bin/bash coder && echo "coder ALL=(ALL) NOPASSWD:ALL" >> /etc/sudoers

RUN curl -fsSL https://deb.nodesource.com/setup_20.x | bash - \
    && apt-get install -y nodejs \
    && npm install -g @anthropic-ai/claude-code

RUN ssh-keygen -A && mkdir /run/sshd \
    && sed -i 's/#PermitRootLogin.*/PermitRootLogin no/' /etc/ssh/sshd_config \
    && echo 'export ANTHROPIC_BASE_URL=${ANTHROPIC_BASE_URL}' > /etc/profile.d/claude-env.sh \
    && echo 'export ANTHROPIC_API_KEY=${ANTHROPIC_API_KEY}' >> /etc/profile.d/claude-env.sh
EXPOSE 22

USER coder
WORKDIR /home/coder

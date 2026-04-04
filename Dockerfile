FROM node:18

# Install nmap
RUN apt-get update && apt-get install -y nmap

# Create app directory
WORKDIR /app

# Copy files
COPY . .

# Install dependencies
RUN npm install

# Run MCP server
CMD ["node", "server.js"]
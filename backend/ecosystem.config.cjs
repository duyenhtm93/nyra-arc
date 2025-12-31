module.exports = {
    apps: [
        {
            name: "nyra-price-keeper",
            script: "./dist/priceUpdater.js",
            cwd: "./",
            instances: 1,
            autorestart: true,
            watch: false,
            max_memory_restart: "200M",
            env: {
                NODE_ENV: "production",
                // Environment variables will be loaded from .env file automatically by PM2
                // or you can define them here
            }
        }
    ]
};

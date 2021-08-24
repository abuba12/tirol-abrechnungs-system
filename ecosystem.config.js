module.exports = {
  apps : [{
    name: "TAS",
    script: 'app.js',
    watch: true,
    autorestart: true,
    env: {
      NODE_ENV: "production"
    }
  }]

};

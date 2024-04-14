FROM node:14

WORKDIR /app

COPY package*.json ./

RUN npm install

RUN npm install pm2 -g

COPY . .

ENV PORT=5000
ENV NODE_ENV=production

CMD ["pm2-runtime","start","ecosystem.config.js"]

FROM node:18

EXPOSE 3000

RUN npm install -g npm@latest

WORKDIR /otfc

COPY package.json ./

RUN npm install --omit=dev

CMD ["node","src/endpoint.js"]

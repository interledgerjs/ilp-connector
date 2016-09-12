FROM node:4-slim

RUN mkdir -p /usr/src/app
WORKDIR /usr/src/app

COPY . /usr/src/app

RUN cd /usr/src/app && npm install

EXPOSE 3000

CMD [ "npm", "start" ]

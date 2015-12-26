FROM node:4-slim

RUN mkdir -p /usr/src/app
WORKDIR /usr/src/app

COPY . /usr/src/app

EXPOSE 4000

CMD [ "npm", "start" ]

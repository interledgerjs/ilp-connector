FROM node:6.9-slim

RUN mkdir -p /usr/src/app
WORKDIR /usr/src/app

COPY . /usr/src/app
RUN apt-get update && apt-get install -y git
RUN npm install

EXPOSE 3000

CMD [ "npm", "start" ]

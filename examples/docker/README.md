
#Connector Modes in docker

#Run in connector mode
Run the following command

```shell
  docker run --net=bridge -p 7780:7780 -it --rm --env-file=./examples/docker/.connector.env --name=connector interledgerjs/ilp-connector
```

Take note of the IP address of the container once running. Port 7780 is exposed to host to allow for connection to admin
API

#Run in plugin mode
Run the following command

```shell
  docker run --net=bridge -it --rm --env-file=./examples/docker/.plugin.env interledgerjs/ilp-connector
```

Note that in .plugin.env the IP address of the parent WS connection needs to be updated to 
that of the container running the parent

#Updating accounts

profile.js has been included as an easy method to generate JSON stringified account details to pass through
to the containers environment variables. Edit the account details inside and run to get the required variables.

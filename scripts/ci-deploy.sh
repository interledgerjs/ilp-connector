#!/bin/bash -ex

publishNpm() {
  # Push NPM package if not yet published
  mv npmrc-env .npmrc
  if [ "$(npm show ilp-connector version)" != "$(npm ls --depth=-1 2>/dev/null | head -1 | cut -f 1 -d " " | cut -f 2 -d @)" ]; then
    npm publish
  fi
}

pushDocker() {
  # Push Docker image tagged latest and tagged with commit descriptor
  local REGISTRY=""
  local NAMESPACE="interledger/"
  local REPO="js-ilp-connector"
  # rm is false because on Circle the process doesn't have permissions to delete the intermediate container
  docker build -t $NAMESPACE$REPO --rm=false .
  docker login -u $DOCKER_USER -p $DOCKER_PASS -e $DOCKER_EMAIL $REGISTRY
  docker tag $NAMESPACE$REPO":latest" $NAMESPACE$REPO":$(git describe)"
  docker push $NAMESPACE$REPO":latest"
  docker push $NAMESPACE$REPO":$(git describe)"
}

publishNpm
pushDocker


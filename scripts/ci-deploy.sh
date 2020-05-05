#!/bin/bash -ex

# Push Docker image tagged latest and tagged with commit descriptor
REGISTRY=""
NAMESPACE="interledger/"
REPO="js-ilp-connector"
# rm is false because on Circle the process doesn't have permissions to delete the intermediate container
docker build -t $NAMESPACE$REPO --rm=false .
docker login -u $DOCKER_USER -p $DOCKER_PASS $REGISTRY
docker tag $NAMESPACE$REPO":latest" $NAMESPACE$REPO":$(git describe)"
docker push $NAMESPACE$REPO":latest"
docker push $NAMESPACE$REPO":$(git describe)"

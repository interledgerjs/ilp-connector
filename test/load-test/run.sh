#!/usr/bin/env bash

export MESSAGES=100
export LOOPS=10

for i in "$@"
do
case $i in
    -m=*|--messages=*)
    export MESSAGES="${i#*=}"
    shift # past argument=value
    ;;
    -l=*|--loops=*)
    export LOOPS="${i#*=}"
    shift # past argument=value
    ;;
    --default)
    DEFAULT=YES
    shift # past argument with no value
    ;;
    *)
          # unknown option
    ;;
esac
done

echo "Running load test with" $MESSAGES "messages and" $LOOPS "loops..."
docker-compose up --abort-on-container-exit

tail -1 ./jmeter.log
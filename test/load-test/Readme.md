#Load testing the connector
Performs a load test on the connector using jmeter. The default load test creates a connector with 
2 accounts: USER0001 and load-test. Jmeter then connects to USER0001 and sends 100 packets destined for the load-test account. 
It repeats this 10 times. The load-test account responds with an IlpFulfill created using the data in the IlpPrepare.

##Running a load test
The run.sh script will perform the load test. The number of messages Jmeter will send to USER0001 and the number of loops to perform 
may be specified as shown below. 

```bash
./run.sh -m=150 -l=2

```

##Results
The result of the test can be found in jmeter.log. This file is created once Jmeter is finished. The last line will have a summary of the throughput, % error of failed packets as well as 
the average, min and max round trip message times in ms. 
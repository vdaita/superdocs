import React, { useState, useEffect } from 'react';
import { Container, Button, Text, Textarea, Tabs } from '@mantine/core';

export default function App(){
  let [query, setQuery] = useState("");

  let [numberOfGenerations, setNumberOfGenerations] = useState(5);
  let [maxTreeHeight, setMaxTreeHeight] = useState(1);

  let processQuery = () => {
    // Parallelize queries to large model;
    let n = new Node();
    while(n.height <= maxTreeHeight){
      let bestNode = n.getBestNode();
      // Write down which node is being selected and show a description about the best one
  
      if(bestNode == null){
        bestNode = n;
      }

      // Generate children

      // Reflect on children responses
    }
  }

  

  return (
    <Container>
      <Textarea onChange={(e) => setQuery(e.target.value)} value={query}>
      </Textarea>
      
      <Tabs>
        <Tabs.List>
          {currentGenerations.map((item, index) => (
            <Tabs.Tab value={index.toString()}>
              Generation {index}
            </Tabs.Tab>
          ))}
        </Tabs.List>
        {currentGenerations.map((item, index) => (
          <Tabs.Panel value={index.toString()}>
            {item}
          </Tabs.Panel>
        ))}
      </Tabs>

      
    </Container>
  );
}
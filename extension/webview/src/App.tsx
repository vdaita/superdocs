import React, { useState, useEffect } from 'react';
import { Container, Button, Text, Textarea, Tabs, Card, Badge, Loader, Box } from '@mantine/core';
import GenerationNode from './lib/Node';
import { Snippet } from './lib/Snippet';
import EnhancedMarkdown from './lib/EnhancedMarkdown';
import { createClient } from '@supabase/supabase-js';
import OpenAI from 'openai';
import { notifications } from '@mantine/notifications';
import { VSCodeMessage } from './lib/VSCodeMessage';
import { usePostHog } from 'posthog-js/react'
import { CodeBlock } from 'react-code-blocks';

const SUPABASE_URL = "https://qqlfwjdpxnpoopgibsbm.supabase.co";
const SUPABASE_ANON_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InFxbGZ3amRweG5wb29wZ2lic2JtIiwicm9sZSI6ImFub24iLCJpYXQiOjE3MDE0MDM0MjYsImV4cCI6MjAxNjk3OTQyNn0.FfCGI17DLv3Ejsno5--5XyfzCQtCLnoyeTf2cxGgOvc";
const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

type Generation = {
  planCompleted: boolean;
  changesCompleted: boolean;
  changes: {
    filepath: string;
    instruction: string;
    location: string;
    search_block: string;
    replace_block: string;
  }[];
  rank: number;
  progress: string;
  plan: string;
  summary: string;
};

export default function App(){
  let [query, setQuery] = useState("");
  let [snippets, setSnippets] = useState<Snippet[]>([]);
  let [generations, setGenerations] = useState<Generation[]>();
  let [error, setError] = useState<string | undefined>();

  let [userData, setUserData] = useState<any>(false);
  const posthog = usePostHog();

  useEffect(() => {
    console.log("Running useEffect");
    VSCodeMessage.onMessage((message) => {
      message = message.data;
      console.log("Received message: ", message);
      if(message.type === "context") {
        if(message.content.telemetryAllowed) {
          posthog.opt_in_capturing();
        } else {
          posthog.opt_out_capturing();
        }
      } else if (message.type === "snippet") {
        console.log("Received snippet: ", message)
        setSnippets((prevSnippets) => {
          console.log("Considering adding a new snippet to this list of snippets: ", prevSnippets);
          let alreadyExists = false;
          for(var i = 0; i < prevSnippets.length; i++){
            // console.log("Comparing: ", {
            //   currFilepath: prevSnippets[i].filepath,
            //   currCode: prevSnippets[i].code,
            //   newFilepath: message.content.filepath,
            //   newCode: message.content.code,
            //   returning: prevSnippets[i].filepath === message.content.filepath && prevSnippets[i].code === message.content.code
            // });
            if(prevSnippets[i].filepath === message.content.filepath && prevSnippets[i].code === message.content.code){
              alreadyExists = true;
              break;
            }
          }
          
          if(alreadyExists){
            return prevSnippets;
          } else {
            return [...prevSnippets, {
              code: message.content.code,
              filepath: message.content.filepath,
              language: message.content.language
            }]
          }
        });
      }
    });
    VSCodeMessage.postMessage({
      type: "startedWebview"
    });
    // TODO: listen for a change in the authentication state
  }, []);

  let launchRequests = async () => { // Should be making multiple requests at the same time.
    
  }

  // TOOD: make sure that you allow the person to reclick for anonymous authentication again.

  let processRequest = async () => {
    console.log("Current environment: ", process.env.NODE_ENV);
    let url = (process.env.NODE_ENV === "development") ? "http://localhost:8000/get_completion" : "";
    let accessToken = ((await supabase.auth.getSession()).data.session?.access_token);

    let response = await fetch(url, {
      body: JSON.stringify({
        snippets: snippets,
        request: query,
        jwt_token: ""
      }),
      method: "POST",
      headers: {
        'Accept': 'application/json',
        'Content-Type': 'application/json'
      }
    });
    if(response.ok){
      const reader = response.body!.getReader();
      const decoder = new TextDecoder();

      let done = false;
      while(!done){
        const { value, done: doneReading } = await reader.read();
        done = doneReading;
        let chunkValue = decoder.decode(value);
        console.log("Chunk value from backend: ", chunkValue);
        if(chunkValue.length == 0){
          console.log("Blank chunk - skipping.");
          continue;
        }
        let generations: Generation[] = JSON.parse(chunkValue);
        setGenerations(generations);
      }
    } else {
      setError("There was an error on the server.");
    }
  }

  let deleteSnippet = (index: number) => {
    setSnippets((prevSnippets: Snippet[]) => {
      let newList = prevSnippets.splice(index, 1);
      console.log("Spliced list: ", newList);
      return newList;
    });
  }

  let authenticate = async () => {
    const { data, error } = await supabase.auth.signInWithOAuth({
      provider: 'github'
    });
    if(!error){
      setUserData(data);
    } else {
      notifications.show({
        title: "There was an error with authentication",
        message: "Please try again"
      })
    }
  }

  return (
    <Container>
      <Textarea onChange={(e) => setQuery(e.target.value)} value={query}>
      </Textarea>
      <Container m="sm">
        {snippets.map((item, index) => (
          <Card shadow="sm" padding="lg" radius="md" withBorder>
            <EnhancedMarkdown message={{
              role: "snippet",
              content: `${item.filepath}\n\n` + "```" + `${item.language}\n${item.code}` + "\n```"
            }}/>
            <Button onClick={() => deleteSnippet(index)}>
              Delete Snippet
            </Button>
          </Card>
        ))}
      </Container>
      <Button onClick={() => processRequest()}>Process request</Button>
      {error && <Box color="red">
        {error}
      </Box>}
      
      {generations && 
        <>
            {generations!.map((generation, index) => (
                <>
                    {!generation.planCompleted && <EnhancedMarkdown message={
                      {
                        role: "Planning in progress",
                        content: generation["progress"]
                      }}></EnhancedMarkdown>}
                    {generation.planCompleted && <>
                      <Badge color="green">Summary</Badge>
                      <Text>{generation.summary}</Text>
                      <Badge color="green">Plan</Badge>
                      <Text>{generation.plan}</Text>
                      {!generation.changesCompleted && <Loader color="blue" type="dots"/>}
                      {generation.changesCompleted && <>
                        {generation.changes.map((change, index) => (
                          <>
                            <Text>{change.filepath}</Text>
                            <CodeBlock text={change.search_block} codeContainerStyle={{background: 'red'}}></CodeBlock>
                            <CodeBlock text={change.replace_block} codeContainerStyle={{background: 'green'}}></CodeBlock>
                            <Button>Make replacement</Button>
                          </>
                        ))}
                    </>}
                  </>}
                </>
            ))}
          </>
      }


    </Container>
  );
}
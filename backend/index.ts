import OpenAI from 'openai';
import Groq from 'groq-sdk';
import { distance, closest } from 'fastest-levenshtein';
import { jwtVerify } from 'jose';
import { getFixedSearchReplace } from './diff';
import { AIDER_UDIFF_PLAN_AND_EXECUTE_PROMPT } from './prompts';

console.log("Hello via Bun!");
const groq = new Groq();
const openai = new OpenAI();

type Plan = {
    message: string
    editInstructions: EditInstruction[]
    // newFiles: NewFile[]
}

type EditInstruction = {
    instruction: string
    // filepath: string
    changesCompleted: boolean
    changes?: Change[]
}

type Change = {
    filepath: string
    searchBlock: string
    replaceBlock: string
}

type NewFile = {
    filepath: string,
    code: string
}

type Snippet = {
    filepath: string
    code: string
    language: string
  }

// type Update = {
//     section: "plan" | "change"
//     planId: number
//     instructionId?: number
//     type: "update" | "completion"
//     content: string | Plan | Change
// }

Bun.serve({
    port: 3000,
    async fetch(req) {
        const reqJson = await req.json();
        let snippets: Snippet[] = reqJson["snippets"];
        let filepaths: string[] = [];
        snippets.forEach((snippet) => { filepaths.push(snippet.filepath); });
        
        let unifiedSnippets: Snippet[] = [];
        let files = new Map();
        filepaths.forEach((filepath) => {
            let codeChunks: string[] = [];
            let lang: string = "";            
            snippets.forEach((snippet) => {
                if(snippet.filepath === filepath) {
                    codeChunks.push(snippet.code);
                    lang = snippet.language;
                }
            });
            unifiedSnippets.push({
                filepath: filepath,
                code: codeChunks.join("\n----\n"),
                language: lang
            });
            files.set(filepath, codeChunks.join("\n----\n"));
        });

        let fileContextStr = "";
        unifiedSnippets.forEach((snippet) => {
            fileContextStr += `[${snippet.filepath}]\n \`\`\`\n${snippet.code}\n\`\`\`\n`
        });

        // try {
        //     const user = await jwtVerify(
        //         reqJson["session"]["accessToken"],
        //         new TextEncoder().encode(process.env.SUPABASE_JWT_SECRET)
        //     );
        //     // Either user is verified or this fails.
        // } catch (e) {
        //     console.error("Token validation failed: ", e);
        //     throw "Token validation failed.";
        // }

        const stream = new ReadableStream({
            async start(controller) {
                let planResponse = await groq.chat.completions.create({
                    messages: [{
                        role: "system",
                        content: `You are an intelligent coding assistant. 
                        You can give a general message with an answer to the user and you can additionally provide edit instructions that will be completed by another bot. 
                        Include new code in the message portion.
                        Each of the edit instructions should be able to be executed in parallel.
                        Output your response in the following JSON format:
                        {
                            message: "A string that describes a message that you want to send to the user describing your changes.",
                            editInstructions: ["First instruction", "Second instruction", "Third instruction"],
                        }
                        `
                    }],
                    model: "llama3-8b-8192"
                });
                let parsedPlanResponse = JSON.parse(planResponse.choices[0].message.content!);
                
                let plan: Plan = {
                    message: parsedPlanResponse["message"],
                    editInstructions: [],
                    // newFiles: parsedPlanResponse["newFiles"]
                };

                for(var i = 0; i < parsedPlanResponse["editInstructions"].length; i++){
                    plan.editInstructions.push({
                        instruction: parsedPlanResponse["instructions"][i],
                        changesCompleted: false
                    })
                }

                controller.enqueue(JSON.stringify([plan]));

                let instructionProcessingRequests = [];
                
                for(var i = 0; i < plan.editInstructions.length; i++) {
                    instructionProcessingRequests.push(new Promise<EditInstruction>(async () => {
                        let newInstruction: EditInstruction = {
                            instruction: plan.editInstructions[i].instruction, 
                            changesCompleted: true,
                            changes: []
                        };

                        try {
                            const instResponse = await openai.chat.completions.create({
                                messages: [
                                    {
                                        "role": "system",
                                        "content": AIDER_UDIFF_PLAN_AND_EXECUTE_PROMPT
                                    },
                                    {
                                        "role": "user",
                                        "content": fileContextStr + `\n Implement the following and the following only. Other required steps will be completed elsewhere. Instruction: ${plan.editInstructions[i].instruction}`
                                    }
                                ],
                                model: "gpt-4o"
                            });
                            let diffMd = instResponse.choices[0].message.content!;
                            let fixedSearchReplaces = getFixedSearchReplace(files, diffMd);
                            fixedSearchReplaces.forEach((fsr) => {
                                newInstruction.changes?.push({
                                    filepath: fsr.filepath,
                                    searchBlock: fsr.searchBlock,
                                    replaceBlock: fsr.replaceBlock
                                });
                            });

                            return newInstruction;
                        } catch (e) {
                            return newInstruction;
                        }
                    }));
                }

                let changedInstructions: EditInstruction[] = await Promise.all(instructionProcessingRequests);
                plan.editInstructions = changedInstructions;

                // Send these instructions back 
                controller.enqueue(JSON.stringify([plan]));
            }
        })

        return new Response(stream);
    },
  });
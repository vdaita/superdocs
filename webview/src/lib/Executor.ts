import OpenAI from 'openai';

// Take a set of files, general information, produces a new set of changes

type SuperdocsPlan = {
    steps: {location: string, instruction: string}[]
    summary: string
}

type Change = {
    filePath: string,
    searchBlock: string,
    replaceBlock: string
}

function parseXmlToSuperdocsPlan(xmlString: string): SuperdocsPlan {
    // Parse the XML string
    const parser: DOMParser = new DOMParser();
    const xmlDoc: Document = parser.parseFromString(xmlString, "text/xml");

    // Extract summary
    let summary: string = "";
    const summaryNode: Element | null = xmlDoc.querySelector('summary');
    if (summaryNode) {
        summary = summaryNode.textContent?.trim() || "";
    }

    // Extract locations and instructions
    const stepsNode: Element | null = xmlDoc.querySelector('steps');
    const stepNodes: NodeListOf<Element> | undefined = stepsNode?.querySelectorAll('step');

    const steps: { location: string, instruction: string }[] = [];
    if (stepNodes) {
        stepNodes.forEach(stepNode => {
            const locNode: Element | null = stepNode.querySelector('loc');
            const instNode: Element | null = stepNode.querySelector('inst');
            const location: string = locNode?.textContent?.trim() || "";
            const instruction: string = instNode?.textContent?.trim() || "";
            if (location && instruction) {
                steps.push({ location, instruction });
            }
        });
    }

    return { steps, summary };
}

let stringifyPlan = (plan: SuperdocsPlan) => {
    let planSummary = `# Summary:\n ${plan.summary}\n`
    let changes = `# Change descriptions:\n`
    plan.steps.forEach((step) => {
        changes += `## Location:\n${step.location}\n## Instruction:\n${step.instruction}`
    });
    return planSummary + changes;
}

let implementChanges = async function* (request: string, context: string) {
    
    let generatedPlan = await;
    // Parse the plan according to some schema
    let parsedPlan: SuperdocsPlan = parseXmlToSuperdocsPlan(generatedPlan);
    yield stringifyPlan(parsedPlan);

    let changePromises: Promise<string>[] = [];
    parsedPlan.steps.forEach((change) => {
        changePromises.push(Model.CodeExecutor.request("Implement the following change: "));
    });

    yield stringifyPlan(parsedPlan);

    let changes = await Promise.all(changePromises);
    let extractedChanges: Change[] = [];

    changes.forEach((change) => {
        const codeBlocks = change.match(/```[\s\S]*?```/g); 
        codeBlocks!.forEach((codeBlock) => {
            const regex = /(.+?)\n<<<<<SEARCH\n([\s\S]*?)\n=======\n([\s\S]*?)\n>>>>>REPLACE/g;
            let match;
            while ((match = regex.exec(codeBlock)) !== null) {
                const [, filePath, searchBlock, replaceBlock] = match;
                extractedChanges.push({filePath, searchBlock, replaceBlock });
            }
        })
    });

    yield changes;
}
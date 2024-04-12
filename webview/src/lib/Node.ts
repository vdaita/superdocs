class GenerationNode {
    children: GenerationNode[];
    score: number;
    reflection: string;
    // Not using is_solved to create as many generations as desired.

    constructor(fileModifications: any, score: number, reflection: string){
        this.children = [];
        this.score = score;
        this.reflection = reflection;
    }

    getBestChild(){
        if(this.children.length == 0){
            return this;
        }
        let all_nodes = this.getAllChildren();
        return all_nodes.reduce((prev, current) => {
            return prev.score > current.score ? prev : current
        })
    }

    getAllChildren(): GenerationNode[]{
        let allNodes = [this as GenerationNode];
        this.children.map((item, index, arr) => {
            allNodes = [...allNodes, ...item.getAllChildren()];
        });
        return allNodes;
    }
}

export default GenerationNode;
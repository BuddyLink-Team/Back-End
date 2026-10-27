import { AI_TOOL_NAMES } from '../ai-assistant.constants.js';

export const getMyChildrenTool = {
  declaration: {
    name: AI_TOOL_NAMES.GET_MY_CHILDREN,
    description:
      "List the parent's own children (id, name, age, gender, interests, favourite activities). Call it before tailoring advice when the children are not known yet.",
    parametersJsonSchema: { type: 'object', properties: {} },
  },

  async execute(_args, ctx) {
    const children = await ctx.getChildren();
    return { children, count: children.length };
  },
};

export default getMyChildrenTool;

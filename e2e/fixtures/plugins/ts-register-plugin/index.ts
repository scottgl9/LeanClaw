const plugin = {
  id: 'ts-register-plugin',
  register(api: any) {
    api.registerTool({
      name: 'test_tool',
      description: 'A test tool for compatibility testing',
      parameters: { type: 'object', properties: { q: { type: 'string' } }, required: ['q'] },
      execute: async (_id: string, p: { q: string }) => ({ result: p.q }),
    });
  },
};
export default plugin;

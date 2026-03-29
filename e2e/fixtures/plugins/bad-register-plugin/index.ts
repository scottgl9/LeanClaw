const plugin = {
  id: 'bad-register-plugin',
  register(_api: any) {
    throw new Error('Intentional register() failure for testing');
  },
};
export default plugin;

export default async function globalTeardown() {
  const instance = global.__MONGOINSTANCE;
  if (instance) {
    await instance.stop();
  }
}

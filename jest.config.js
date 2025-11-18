export default {
  testEnvironment: 'jsdom',
  testMatch: ['**/test/browser.test.js'],
  transform: {},
  testPathIgnorePatterns: ['/node_modules/', '/pkg/'],
  setupFiles: ['<rootDir>/jest.setup.js'],
  moduleNameMapper: {
    '^(\\.{1,2}/.*)\\.js$': '$1',
  },
};

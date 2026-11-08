// A test suite's throwaway container, named so it reads as a test's and as throwaway: playground-test-<suite>-<pid>, the pid of the test runner that started it. ops-sweep removes one whose pid no longer runs (a run killed before afterAll never reaches the suite's cleanup); every other container stays.
export const testContainerName = (suite: string): string =>
  `playground-test-${suite}-${process.pid}`

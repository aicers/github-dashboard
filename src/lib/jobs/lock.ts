export type JobType = "sync" | "backup" | "restore" | "transfer";

type TailResolver = (value?: void | PromiseLike<void>) => void;

type JobLockState = {
  tail: Promise<void>;
  resolveTail: TailResolver | null;
  currentType: JobType | null;
};

type GlobalWithJobLock = typeof globalThis & {
  __githubDashboardJobLock?: JobLockState;
};

function getJobLockState() {
  const globalWithLock = globalThis as GlobalWithJobLock;
  if (!globalWithLock.__githubDashboardJobLock) {
    globalWithLock.__githubDashboardJobLock = {
      tail: Promise.resolve(),
      resolveTail: null,
      currentType: null,
    };
  }

  return globalWithLock.__githubDashboardJobLock;
}

export function getCurrentJobType(): JobType | null {
  return getJobLockState().currentType;
}

export async function withJobLock<T>(type: JobType, handler: () => Promise<T>) {
  const state = getJobLockState();
  const previousTail = state.tail;

  state.tail = new Promise<void>((resolve) => {
    state.resolveTail = resolve;
  });

  if (state.currentType && state.currentType !== type) {
    console.info(
      `[scheduler] ${type} job waiting for ${state.currentType} to finish.`,
    );
  }

  await previousTail;

  state.currentType = type;

  try {
    return await handler();
  } finally {
    state.currentType = null;
    const resolver = state.resolveTail;
    if (resolver) {
      resolver();
    }
    state.resolveTail = null;
  }
}

export class SerialExecutor {
  private tail: Promise<void> = Promise.resolve();

  run(task: () => Promise<void>): Promise<void> {
    const next = this.tail.then(task, task);
    this.tail = next.catch(() => undefined);
    return next;
  }
}

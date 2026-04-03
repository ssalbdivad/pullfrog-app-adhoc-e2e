import { performance } from "node:perf_hooks";
import * as cli from "./cli.ts";
import { ThinkingTimer, Timer } from "./timer.ts";

describe("Timer", () => {
  beforeEach(() => {
    vi.spyOn(cli.log, "debug");
    // Mock performance.now() to have predictable timestamps
    vi.spyOn(performance, "now");
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe("constructor", () => {
    it("should initialize with current timestamp", () => {
      const mockTime = 1000000;
      vi.mocked(performance.now).mockReturnValueOnce(mockTime).mockReturnValueOnce(mockTime);

      const timer = new Timer();
      timer.checkpoint("test");

      expect(cli.log.debug).toHaveBeenCalledWith(expect.stringContaining("test"));
    });
  });

  describe("checkpoint", () => {
    it("should log duration from initial timestamp on first checkpoint", () => {
      const startTime = 1000000;
      const checkpointTime = startTime + 100;
      vi.mocked(performance.now)
        .mockReturnValueOnce(startTime) // constructor
        .mockReturnValueOnce(checkpointTime); // checkpoint

      const timer = new Timer();
      timer.checkpoint("first");

      expect(cli.log.debug).toHaveBeenCalledWith("» first: 100ms");
    });

    it("should log duration from last checkpoint on subsequent checkpoints", () => {
      const startTime = 1000000;
      const firstCheckpointTime = startTime + 50;
      const secondCheckpointTime = firstCheckpointTime + 75;
      vi.mocked(performance.now)
        .mockReturnValueOnce(startTime) // constructor
        .mockReturnValueOnce(firstCheckpointTime) // first checkpoint
        .mockReturnValueOnce(secondCheckpointTime); // second checkpoint

      const timer = new Timer();
      timer.checkpoint("first");
      timer.checkpoint("second");

      expect(cli.log.debug).toHaveBeenCalledTimes(2);
      expect(cli.log.debug).toHaveBeenNthCalledWith(1, "» first: 50ms");
      expect(cli.log.debug).toHaveBeenNthCalledWith(2, "» second: 75ms");
    });

    it("should handle multiple checkpoints correctly", () => {
      const startTime = 1000000;
      vi.mocked(performance.now)
        .mockReturnValueOnce(startTime) // constructor
        .mockReturnValueOnce(startTime + 10) // step1
        .mockReturnValueOnce(startTime + 25) // step2
        .mockReturnValueOnce(startTime + 45); // step3

      const timer = new Timer();
      timer.checkpoint("step1");
      timer.checkpoint("step2");
      timer.checkpoint("step3");

      expect(cli.log.debug).toHaveBeenCalledTimes(3);
      expect(cli.log.debug).toHaveBeenNthCalledWith(1, "» step1: 10ms");
      expect(cli.log.debug).toHaveBeenNthCalledWith(2, "» step2: 15ms");
      expect(cli.log.debug).toHaveBeenNthCalledWith(3, "» step3: 20ms");
    });

    it("should handle zero duration correctly", () => {
      const startTime = 1000000;
      vi.mocked(performance.now)
        .mockReturnValueOnce(startTime) // constructor
        .mockReturnValueOnce(startTime); // checkpoint

      const timer = new Timer();
      timer.checkpoint("immediate");

      expect(cli.log.debug).toHaveBeenCalledWith("» immediate: 0ms");
    });

    it("should handle custom checkpoint names", () => {
      const startTime = 1000000;
      vi.mocked(performance.now)
        .mockReturnValueOnce(startTime) // constructor
        .mockReturnValueOnce(startTime + 200); // checkpoint

      const timer = new Timer();
      timer.checkpoint("Custom Checkpoint Name");

      expect(cli.log.debug).toHaveBeenCalledWith("» Custom Checkpoint Name: 200ms");
    });
  });
});

describe("ThinkingTimer", () => {
  beforeEach(() => {
    vi.spyOn(cli.log, "info");
    vi.spyOn(performance, "now");
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe("markToolResult", () => {
    it("should store the current timestamp", () => {
      const startTime = 1000000;
      vi.mocked(performance.now)
        .mockReturnValueOnce(startTime) // markToolResult
        .mockReturnValueOnce(startTime + 5000); // markToolCall

      const timer = new ThinkingTimer();
      timer.markToolResult();
      timer.markToolCall();

      expect(cli.log.info).toHaveBeenCalled();
    });
  });

  describe("markToolCall", () => {
    it("should not log if markToolResult was never called", () => {
      const timer = new ThinkingTimer();
      timer.markToolCall();

      expect(cli.log.info).not.toHaveBeenCalled();
    });

    it("should not log if elapsed time is below threshold (3000ms)", () => {
      const startTime = 1000000;
      vi.mocked(performance.now)
        .mockReturnValueOnce(startTime) // markToolResult
        .mockReturnValueOnce(startTime + 2999); // markToolCall

      const timer = new ThinkingTimer();
      timer.markToolResult();
      timer.markToolCall();

      expect(cli.log.info).not.toHaveBeenCalled();
    });

    it("should log if elapsed time equals threshold (3000ms)", () => {
      const startTime = 1000000;
      vi.mocked(performance.now)
        .mockReturnValueOnce(startTime) // markToolResult
        .mockReturnValueOnce(startTime + 3000); // markToolCall

      const timer = new ThinkingTimer();
      timer.markToolResult();
      timer.markToolCall();

      expect(cli.log.info).toHaveBeenCalledWith("» thought for 3 seconds");
    });

    it("should log if elapsed time exceeds threshold", () => {
      const startTime = 1000000;
      vi.mocked(performance.now)
        .mockReturnValueOnce(startTime) // markToolResult
        .mockReturnValueOnce(startTime + 5500); // markToolCall

      const timer = new ThinkingTimer();
      timer.markToolResult();
      timer.markToolCall();

      expect(cli.log.info).toHaveBeenCalledWith("» thought for 5.5 seconds");
    });

    it("should format large durations correctly", () => {
      const startTime = 1000000;
      vi.mocked(performance.now)
        .mockReturnValueOnce(startTime) // markToolResult
        .mockReturnValueOnce(startTime + 15000); // markToolCall

      const timer = new ThinkingTimer();
      timer.markToolResult();
      timer.markToolCall();

      expect(cli.log.info).toHaveBeenCalledWith("» thought for 15 seconds");
    });

    it("should handle multiple markToolCall invocations", () => {
      const startTime = 1000000;
      vi.mocked(performance.now)
        .mockReturnValueOnce(startTime) // markToolResult
        .mockReturnValueOnce(startTime + 4000) // first markToolCall
        .mockReturnValueOnce(startTime + 5000); // second markToolCall

      const timer = new ThinkingTimer();
      timer.markToolResult();
      timer.markToolCall();
      timer.markToolCall();

      expect(cli.log.info).toHaveBeenCalledTimes(2);
      expect(cli.log.info).toHaveBeenNthCalledWith(1, "» thought for 4 seconds");
      expect(cli.log.info).toHaveBeenNthCalledWith(2, "» thought for 5 seconds");
    });
  });
});

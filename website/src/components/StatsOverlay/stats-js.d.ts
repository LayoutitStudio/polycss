declare module "stats-js/src/Stats.js" {
  namespace Stats {
    interface StatsPanel {
      dom: HTMLCanvasElement;
      update(value: number, maxValue: number): void;
    }
  }

  interface StatsInstance {
    dom: HTMLDivElement;
    update(): void;
  }

  interface StatsConstructor {
    new (): StatsInstance;
    Panel: new (name: string, fg: string, bg: string) => Stats.StatsPanel;
  }

  const Stats: StatsConstructor;
  export default Stats;
}

import { Command, flags } from "@oclif/command";
import WebSocket from "ws";
import chokidar from "chokidar";
import fs from "fs";
import { spawn } from "child_process";
import chalk from "chalk";
const fsp = fs.promises;

export default class Watch extends Command {
  static description = "watches files for changes";

  static examples = [];

  static flags = {
    help: flags.help({ char: "h" }),
    port: flags.integer({
      char: "p",
      description: "websocket port to serve to frontend",
      default: 9160,
    }),
  };

  static args = [
    { name: "substance", required: true },
    { name: "style", required: true },
    { name: "domain", required: true },
  ];

  current: { [type: string]: string } = {
    substance: "",
    style: "",
    domain: "",
  };
  currentFilenames: { [type: string]: string } = {
    substance: "",
    style: "",
    domain: "",
  };
  currentState: any = null;

  wss: WebSocket.Server | null = null;

  runPenrose = (packet: any) => {
    const penrose = spawn("penrose", ["runAPI"]);

    penrose.stdin.write(JSON.stringify(packet) + "\n");
    let data = "";
    let err = "";
    penrose.stdout.on("data", async (d: { toString: () => string }) => {
      data += d.toString();
    });
    penrose.stderr.on("data", async (d: any) => {
      err += d.toString();
    });
    penrose.stderr.on("close", async () => {
      if (err !== "") {
        console.error(chalk.red(`failed to compile:`));
        console.error(err);
        return;
      }
    });
    penrose.stdout.on("close", async (cl: any) => {
      if (data === "" || err !== "") {
        return;
      }
      const parsed = JSON.parse(data) as any;
      switch (parsed.type) {
        case "compilerOutput":
          console.info(chalk.green(`successfully compiled`));
          this.currentState = { type: "state", contents: parsed.contents[0] };
          this.wss?.clients.forEach((ws) => {
            ws.send(JSON.stringify(this.currentState));
          });
          break;
        case "state":
          console.info(chalk.green(`successfully resampled`));
          this.currentState = parsed;
          this.wss?.clients.forEach((ws) => {
            ws.send(JSON.stringify(this.currentState));
          });
          break;
        case "error":
          const errColorMap = {
            SubstanceParse:
              chalk.cyanBright(`parse substance`) +
              chalk.red(` (${this.currentFilenames.substance})`),
            SubstanceTypecheck:
              chalk.bgRedBright(`typecheck substance`) +
              chalk.red(` (${this.currentFilenames.substance})`),
            StyleParse:
              chalk.blueBright(`parse style`) +
              chalk.red(` (${this.currentFilenames.style})`),
            StyleLayering:
              chalk.bgBlueBright(`layer style`) +
              chalk.red(` (${this.currentFilenames.style})`),
            StyleTypecheck:
              chalk.bgBlueBright(`typecheck style`) +
              chalk.red(` (${this.currentFilenames.style})`),
            ElementParse:
              chalk.magentaBright(`parse domain`) +
              chalk.red(` (${this.currentFilenames.domain})`),
            ElementTypecheck:
              chalk.magentaBright(`typecheck domain`) +
              chalk.red(` (${this.currentFilenames.domain})`),
            PluginParse: chalk.yellowBright(`parse plugin`),
            PluginRun: chalk.yellowBright(`run plugin`),
          } as any;
          console.error(
            `${chalk.red("error: failed to")} ${
              errColorMap[parsed.contents.tag] ||
              "unknown error: check cli code"
            }:`
          );
          console.error(parsed.contents.contents);
          break;
        default:
          console.log(parsed);
          break;
      }
    });

    penrose.stdin.end();
  };

  readFile = async (fileName: string) => {
    try {
      const read = await fsp.readFile(fileName, "utf8");
      return read;
    } catch (err) {
      console.error(`Could not open ${fileName}: ${err}`);
      this.exit(1);
    }
  };

  watchFile = async (fileName: string, type: string) => {
    const watcher = chokidar.watch(fileName, {
      awaitWriteFinish: {
        pollInterval: 100,
        stabilityThreshold: 300, // increase to make file listen faster
      },
    });
    this.currentFilenames[type] = fileName;
    watcher.on("error", (err: Error) => {
      console.error(`Could not open ${fileName} ${type}: ${err}`);
      this.exit(1);
    });
    watcher.on("change", async () => {
      const str = await this.readFile(fileName);
      this.current[type] = str;
      console.info(
        chalk.blueBright(`${type}`) +
          chalk.whiteBright(` ${fileName}`) +
          chalk.blueBright(` updated, recompiling...`)
      );
      const { substance, style, domain } = this.current;
      const packet = {
        tag: "CompileTrio",
        contents: [substance, style, domain],
      };
      this.runPenrose(packet);
    });
    const str = await this.readFile(fileName);
    this.current[type] = str;
  };

  async run() {
    const { args, flags } = this.parse(Watch);

    console.info(chalk.blue(`starting on port ${flags.port}...`));

    await this.watchFile(args.substance, "substance");
    await this.watchFile(args.style, "style");
    await this.watchFile(args.domain, "domain");

    this.wss = new WebSocket.Server({
      port: flags.port,
    });

    this.wss.on("connection", (ws) => {
      if (this.currentState !== null) {
        ws.send(JSON.stringify(this.currentState));
      }
      ws.on("message", (m) => {
        const parsed = JSON.parse(m as string);
        if (parsed.call && parsed.call.tag === "Resample") {
          this.runPenrose(parsed.call);
        }
      });
    });
    const { substance, style, domain } = this.current;
    const packet = {
      tag: "CompileTrio",
      contents: [substance, style, domain],
    };
    this.runPenrose(packet);
  }
}

/**
 * Application entry point.
 */
import "./styles/main.css";
import { GestureSynthApp } from "./app";

const app = new GestureSynthApp();

app.start().catch((error) => console.error(error));

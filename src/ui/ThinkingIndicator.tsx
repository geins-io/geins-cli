import React, { useState, useEffect, useRef } from 'react';
import { Box, Text } from 'ink';
import Spinner from 'ink-spinner';

const THINKING_PHRASES = [
  'Razzmatazzing',
  'Consulting the oracle',
  'Wrangling neurons',
  'Brewing thoughts',
  'Tickling the AI',
  'Summoning wisdom',
  'Juggling tokens',
  'Crunching vibes',
  'Doing brain stuff',
  'Spinning hamster wheels',
  'Poking the matrix',
  'Shuffling electrons',
  'Warming up synapses',
  'Herding bits',
  'Whispering to GPUs',
  'Aligning chakras',
  'Befriending algorithms',
  'Calibrating sass levels',
  'Defragmenting thoughts',
  'Encrypting brilliance',
  'Flipping mental pancakes',
  'Generating eureka moments',
  'Hacking the mainframe',
  'Inflating brain balloons',
  'Jazzing up the response',
  'Knitting logic sweaters',
  'Loading witty remarks',
  'Manifesting answers',
  'Negotiating with servers',
  'Orchestrating chaos',
  'Polishing pixels',
  'Querying the universe',
  'Reticulating splines',
  'Summoning the cloud gods',
  'Tuning the frequency',
  'Unscrambling the cosmos',
  'Vibrating at AI frequency',
  'Waking up the hamsters',
  'Xenomorphing data',
  'Yodeling at the API',
  'Zigzagging through logic',
  'Asking the magic 8-ball',
  'Booting imagination',
  'Charging flux capacitor',
  'Downloading inspiration',
  'Engineering serendipity',
  'Feeding the neural beast',
  'Greasing the gears',
  'Harvesting brain waves',
  'Igniting thought rockets',
  'Jolting the circuits',
  'Kindling the spark',
  'Launching thought bubbles',
  'Mining for gold thoughts',
  'Nudging the neurons',
  'Opening the mind vault',
  'Pinging the mothership',
  'Questioning reality',
  'Running the hamster faster',
  'Shaking the magic tree',
  'Tickling the tensor',
  'Unleashing creativity',
  'Vacuuming the brain lint',
  'Watering the idea garden',
  'X-raying the problem',
  'Yanking the wisdom chain',
  'Zapping the thought clouds',
  'Assembling genius parts',
  'Blending brain smoothie',
  'Catching flying ideas',
  'Distilling pure logic',
  'Extracting the good stuff',
  'Fluffing the knowledge',
  'Grinding the think beans',
  'Hugging the algorithm',
  'Invoking ancient wisdom',
  'Jumpstarting cognition',
  'Kneading the data dough',
  'Lassoing loose thoughts',
  'Microwaving the answer',
  'Noodling on it',
  'Overcaffeinating the CPU',
  'Percolating ideas',
  'Quarantining bad takes',
  'Revving the think engine',
  'Sautéing the data',
  'Taming wild thoughts',
  'Uncorking the brain',
  'Ventilating the mind',
  'Winding up the clockwork',
  'Xeroxing smart thoughts',
  'Yelling at the cloud',
  'Zen-mastering the response',
  'Abracadabra-ing',
  'Bibbidi-bobbidi-thinking',
  'Conjuring an answer',
  'Daydream processing',
  'Espresso-shotting the brain',
  'Feng shui-ing the data',
  'Googling with my mind',
  'Hotwiring the cortex',
  'Improvising brilliance',
  'Jedi mind-tricking',
  'Karate-chopping the problem',
  'Levitating the answer',
  'Moonwalking through data',
  'Ninja-scrolling neurons',
  'Om-ing for clarity',
];

function pickRandom(exclude?: string): string {
  let phrase: string;
  do {
    phrase = THINKING_PHRASES[Math.floor(Math.random() * THINKING_PHRASES.length)]!;
  } while (phrase === exclude && THINKING_PHRASES.length > 1);
  return phrase;
}

function formatTime(seconds: number): string {
  if (seconds < 60) return `${seconds}s`;
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return `${m}m ${s.toString().padStart(2, '0')}s`;
}

export function ThinkingIndicator() {
  const [phrase, setPhrase] = useState(() => pickRandom());
  const [elapsed, setElapsed] = useState(0);
  const phraseRef = useRef(phrase);

  useEffect(() => {
    const timer = setInterval(() => {
      setElapsed(e => e + 1);
    }, 1000);
    return () => clearInterval(timer);
  }, []);

  useEffect(() => {
    const cycler = setInterval(() => {
      const next = pickRandom(phraseRef.current);
      phraseRef.current = next;
      setPhrase(next);
    }, 3000);
    return () => clearInterval(cycler);
  }, []);

  return (
    <Box paddingX={1} gap={1}>
      <Spinner type="dots" />
      <Text color="magenta" bold>{phrase}</Text>
      <Text dimColor>({formatTime(elapsed)})</Text>
    </Box>
  );
}

import { motion } from 'motion/react';

export default function LoadingScreen() {
  const text = "CONFAIR TECHNOLOGIES";
  const letters = text.split("");

  return (
    <div className="fixed inset-0 bg-bg flex flex-col items-center justify-center z-[100]">
      <div className="flex mb-4 bg-gradient-to-r from-sky-500 to-gray-500 bg-clip-text text-transparent">
        {letters.map((letter, index) => (
          <motion.span
            key={index}
            initial={{ y: 0, opacity: 1 }}
            animate={{ y: [0, -10, 0], opacity: 1 }}
            transition={{
              duration: 0.6,
              repeat: 1,
              delay: index * 0.04,
              ease: "easeInOut"
            }}
            className="text-lg sm:text-xl font-bold tracking-widest"
          >
            {letter === " " ? "\u00A0" : letter}
          </motion.span>
        ))}
      </div>
      <motion.div
        initial={{ opacity: 1 }}
        animate={{ opacity: 0 }}
        transition={{ delay: 1.0, duration: 0.2 }}
        className="w-64 h-1 bg-gray-300 rounded-full overflow-hidden"
      >
        <motion.div
          initial={{ width: "0%" }}
          animate={{ width: "100%" }}
          transition={{ duration: 1.2, ease: "linear" }}
          className="h-full bg-gradient-to-r from-sky-500 to-gray-500"
        />
      </motion.div>
    </div>
  );
}

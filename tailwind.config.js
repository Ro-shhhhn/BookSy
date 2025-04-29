module.exports = {
    content: ["./views/**/*.{html,ejs}", "./public/js/*.js"],
    theme: {
      extend: {
        colors: {
          primary: "#AB8462", // For your navbar
        },
        keyframes: {
          flyPages: {
            '0%': { transform: 'rotateY(0deg) scale(1)' },
            '100%': { transform: 'rotateY(360deg) scale(1.5)' },
          },
        },
        animation: {
          flyPages: 'flyPages 1s ease-in-out',
        },
      },
    },
    plugins: [],
  }
  
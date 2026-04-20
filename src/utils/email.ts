export const mailGunDomain = process.env.FASTIFY_MAIN_GUN_DOMAIN;
import axios from "axios";
export const mailGun = async (
  from: string,
  to: string,
  subject: string,
  text: string,
) => {
  try {
    const formData = new URLSearchParams();
    formData.append("to", to);
    formData.append("from", from);
    formData.append("subject", subject);
    formData.append("text", text);

    const response = await axios.post(
      `https://api.mailgun.net/v3/sandbox91b12871d2474279b1632cececc7055d.mailgun.org/messages`,
      formData,
      {
        auth: {
          username: "api",
          password: "8aebc4653a2868814895387ee8d41595-8a3819a9-08ff04df",
        },
      },
    );

    return "OK";
  } catch (error) {
    console.log("Email Error", error);
    throw error;
  }
};

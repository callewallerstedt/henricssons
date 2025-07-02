import emailjs from '@emailjs/nodejs';

const serviceId  = 'service_1u5gpw4';
const templateId = 'template_hqk05da';
const publicKey  = 'pzhOOOVxBi01cMxCm';

const templateParams = {
  subject: 'Kapellförfrågan (Test)',
  name   : 'Henricssons Dev',
  email  : 'test@example.com',
  message: 'Detta är ett test utskick från Node-scriptet.'
};

emailjs
  .send(serviceId, templateId, templateParams, { publicKey })
  .then(res => {
    console.log('✅  Email sent! Response:', res.status, res.text);
    process.exit(0);
  })
  .catch(err => {
    console.error('❌  Failed to send email:', err);
    process.exit(1);
  }); 
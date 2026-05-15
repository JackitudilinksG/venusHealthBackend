Deric's Rough Thoughts

## Backend: NestJS
### Auth
&emsp;&emsp;v1. very basic, checkign for user existance from locally hosted db  
&emsp;&emsp;v2. basic, check user existance on a hosted db  
&emsp;&emsp;v3. standard, having functionality to encrypt using bcrypt  
&emsp;&emsp;v4. ...
### Hosting
1. host the front-end on vercel (or elsewhere)
2. users go to 'frontend.host-a.com/sign-in'
3. internally route this to the back-end's hosted end-point 'backend.host-b.com/api/auth/sign-in'

## Resources
For encrption: [bycrpt.js](https://www.npmjs.com/package/bcryptjs)  

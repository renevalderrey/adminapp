const axios = require('axios');
const Setting = require('../models/Setting');

class TiendaNubeService {
  constructor() {
    this.clientId = process.env.TIENDANUBE_CLIENT_ID;
    this.clientSecret = process.env.TIENDANUBE_CLIENT_SECRET;
    // URL base de la API puede variar según el usuario, típicamente es https://api.tiendanube.com/v1/{store_id}
  }

  async getAccessToken(code) {
    try {
      const response = await axios.post('https://www.tiendanube.com/apps/authorize/token', {
        client_id: this.clientId,
        client_secret: this.clientSecret,
        grant_type: 'authorization_code',
        code: code
      });

      const { access_token, token_type, scope, user_id } = response.data;

      // Guardar el token y el user_id (store_id) en la tabla de configuraciones
      await Setting.upsert({ key: 'tiendanube_access_token', value: access_token });
      await Setting.upsert({ key: 'tiendanube_user_id', value: user_id });

      return { access_token, user_id };
    } catch (error) {
      console.error('Error al obtener el Access Token de TiendaNube:', error.response?.data || error.message);
      throw new Error('No se pudo autenticar con TiendaNube');
    }
  }

  async getStoredToken() {
    const tokenSetting = await Setting.findByPk('tiendanube_access_token');
    const userIdSetting = await Setting.findByPk('tiendanube_user_id');
    
    if (!tokenSetting || !userIdSetting) {
      return null;
    }

    return {
      access_token: tokenSetting.value,
      user_id: userIdSetting.value
    };
  }

  // Ejemplo de método para leer productos de TiendaNube
  async getProducts() {
    const credentials = await this.getStoredToken();
    if (!credentials) throw new Error('TiendaNube no está vinculada');

    const response = await axios.get(`https://api.tiendanube.com/v1/${credentials.user_id}/products`, {
      headers: {
        'Authentication': `bearer ${credentials.access_token}`,
        'User-Agent': `Nexar POS (${process.env.TIENDANUBE_CONTACT_EMAIL || 'contacto@tudominio.com'})`
      }
    });

    return response.data;
  }
}

module.exports = new TiendaNubeService();
